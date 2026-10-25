'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '../../../../components/LocaleLink';
import { Building2, Plus, Search, Settings2, BarChart3, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { adminCompanyApi } from '../../../../lib/api';
import { formatMoney, formatDate, errorText, hasWallet } from '../../../../lib/companyLocalization';
import { ORG_TYPES, orgTerms, orgTypeLabel } from '../../../../lib/orgTerms';
import ShippingZoneSelect from '../../../../components/ShippingZoneSelect';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, EmptyState, TableWrap, Th, Td, Modal, Field, CompanyStatusPill,
} from '../../../../components/company/CompanyUI';
import BillingModeFields, { billingFormFrom, billingPatch } from '../../../../components/company/BillingModeFields';
import useRowLink from '../../../../lib/useRowLink';

const EMPTY_FORM = {
    org_type: 'company', name: '', commercial_registration: '', tax_card: '',
    billing_mode: 'monthly', monthly_cap: '', payment_terms_days: '', overdue_grace_days: '',
    office: { name: '', recipient_name: '', phone: '', full_address: '', shipping_country: '', shipping_city: '' },
    manager: { name: '', identifier: '' },
};

export default function AdminCompaniesPage() {
    const rowLink = useRowLink();
    const { language } = useApp();
    const isAr = language === 'ar';
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const [createOpen, setCreateOpen] = useState(false);
    const [notice, setNotice] = useState(null);
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);

    const load = useCallback(async () => {
        try {
            setData(await adminCompanyApi.list({ search, status, page, limit: 25 }));
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [search, status, page, isAr]);

    useEffect(() => {
        const t = setTimeout(load, 250);
        return () => clearTimeout(t);
    }, [load]);

    return (
        <div>
            <PageHeader
                title={isAr ? 'حسابات الشركات والجهات' : 'Corporate accounts'}
                subtitle={isAr ? 'شركات وهيئات ومدارس وعقارات بتطلب لموظفينها أو سكانها بفاتورة شهرية أو محفظة مسبقة الدفع.' : 'Companies, authorities, schools and properties that fund their people\'s orders by monthly invoice or prepaid wallet.'}
                actions={(
                    <>
                        <Link href="/admin/dashboard/companies/stats" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10">
                            <BarChart3 size={16} /> {isAr ? 'الإحصائيات' : 'Statistics'}
                        </Link>
                        <Link href="/admin/dashboard/companies/settings" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10">
                            <Settings2 size={16} /> {isAr ? 'الإعدادات' : 'Settings'}
                        </Link>
                        <Button icon={Plus} onClick={() => setCreateOpen(true)}>{isAr ? 'حساب جديد' : 'New account'}</Button>
                    </>
                )}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}

            <div className={`${CARD} p-4 mb-4 flex flex-col sm:flex-row gap-3`}>
                <div className="relative flex-1">
                    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input className={`${INPUT} w-full ps-9`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={isAr ? 'الاسم' : 'Name'} />
                </div>
                <select className={INPUT} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                    <option value="active">{isAr ? 'نشطة' : 'Active'}</option>
                    <option value="suspended">{isAr ? 'موقوفة' : 'Suspended'}</option>
                    <option value="ended">{isAr ? 'انتهى التعاقد' : 'Contract ended'}</option>
                </select>
            </div>

            <div className={CARD}>
                {!data ? <Spinner /> : data.companies.length === 0 ? (
                    <EmptyState icon={Building2} title={isAr ? 'مفيش حسابات' : 'No accounts'} message={isAr ? 'اعمل أول حساب من زرار "حساب جديد".' : 'Create the first one with "New account".'} />
                ) : (
                    <>
                        <TableWrap>
                            <table className="w-full min-w-[820px]">
                                <thead className="border-b border-zinc-100 dark:border-white/5">
                                    <tr>
                                        <Th align="start">{isAr ? 'الجهة' : 'Account'}</Th>
                                        <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                                        <Th align="start">{isAr ? 'الأعضاء' : 'Members'}</Th>
                                        <Th align="start">{isAr ? 'دعوات مستنية' : 'Pending invites'}</Th>
                                        <Th align="start">{isAr ? 'أوردرات الشهر' : 'Orders this month'}</Th>
                                        <Th align="start">{isAr ? 'صرف الشهر / السقف' : 'Month spend / cap'}</Th>
                                        <Th align="start">{isAr ? 'متبقي على الجهة' : 'Outstanding'}</Th>
                                        <Th align="start">{isAr ? 'مدة السداد' : 'Terms'}</Th>
                                        <Th align="start">{isAr ? 'اتعملت' : 'Created'}</Th>
                                        <Th align="end">{isAr ? 'إجراءات' : 'Actions'}</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {data.companies.map((c) => (
                                        <tr key={c._id} {...rowLink(`/admin/dashboard/companies/${c._id}`)} className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02] cursor-pointer">
                                            <Td align="start">
                                                <Link href={`/admin/dashboard/companies/${c._id}`} className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary">{c.name}</Link>
                                                <p className="text-xs text-zinc-500">{orgTypeLabel(c.org_type, isAr)} · {isAr ? `${c.managers} مدير` : `${c.managers} manager(s)`}</p>
                                            </Td>
                                            <Td align="start"><CompanyStatusPill status={c.status} isAr={isAr} /></Td>
                                            <Td align="start" className="tabular-nums">{c.employees}</Td>
                                            <Td align="start" className="tabular-nums">{c.pending_invitations}</Td>
                                            <Td align="start">
                                                <span className="tabular-nums font-bold">{c.month_orders || 0}</span>
                                                <span className="block text-[11px] text-zinc-500">{isAr ? `${c.month_active_employees || 0} من ${c.employees} ${orgTerms(c.org_type, true).members.replace(/^ال/, '')} طلبوا` : `${c.month_active_employees || 0} of ${c.employees} ${orgTerms(c.org_type, false).members} ordered`}</span>
                                            </Td>
                                            <Td align="start">
                                                <span dir="ltr" className="tabular-nums">{hasWallet(c.billing_mode) ? `${isAr ? 'رصيد المحفظة' : 'Wallet balance'}: ${formatMoney(c.wallet_balance, isAr)}` : `${formatMoney(c.month_spent, isAr)} / ${formatMoney(c.monthly_cap, isAr)}`}</span>
                                                {c.billing_mode === 'credit_wallet' && <span className="block text-[11px] text-zinc-500">{isAr ? `الحد الائتماني: ${formatMoney(c.credit_line, true)}` : `Credit limit: ${formatMoney(c.credit_line, false)}`}</span>}
                                                {!hasWallet(c.billing_mode) && c.monthly_cap > 0 && <CapShare spent={c.month_spent} cap={c.monthly_cap} isAr={isAr} />}
                                            </Td>
                                            <Td align="start">
                                                <span dir="ltr" className="tabular-nums font-bold">{formatMoney(c.collection?.outstanding || 0, isAr)}</span>
                                                {c.collection?.overdue > 0 && (
                                                    <span className="block text-[11px] font-bold text-red-600 dark:text-red-400">
                                                        {isAr ? `متأخر ${formatMoney(c.collection.overdue, true)} (${c.collection.oldest_overdue_days} يوم)` : `${formatMoney(c.collection.overdue, false)} overdue (${c.collection.oldest_overdue_days}d)`}
                                                    </span>
                                                )}
                                                {c.collection?.pending_receipts > 0 && (
                                                    <span className="block text-[11px] font-bold text-amber-600">
                                                        {isAr ? `${c.collection.pending_receipts} إيصال مستني تأكيد` : `${c.collection.pending_receipts} receipt(s) to confirm`}
                                                    </span>
                                                )}
                                            </Td>
                                            <Td align="start">{c.billing_mode === 'credit_wallet' ? (isAr ? 'محفظة بحد ائتماني' : 'Wallet with credit limit') : c.billing_mode === 'wallet' ? (isAr ? 'محفظة مسبقة الدفع' : 'Prepaid wallet') : (isAr ? `${c.payment_terms_days} يوم` : `${c.payment_terms_days} days`)}</Td>
                                            <Td align="start" className="text-zinc-500">{formatDate(c.created_at, isAr)}</Td>
                                            <Td align="end">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" icon={Pencil} onClick={() => setEditing(c)} title={isAr ? 'تعديل' : 'Edit'} aria-label={isAr ? 'تعديل' : 'Edit'} />
                                                    <Button variant="danger" icon={Trash2} onClick={() => setDeleting(c)} title={isAr ? 'حذف' : 'Delete'} aria-label={isAr ? 'حذف' : 'Delete'} />
                                                </div>
                                            </Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableWrap>
                        {data.pagination.pages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 dark:border-white/5 text-xs text-zinc-500">
                                <span>{isAr ? `صفحة ${page} من ${data.pagination.pages}` : `Page ${page} of ${data.pagination.pages}`}</span>
                                <div className="flex gap-2">
                                    <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{isAr ? 'السابق' : 'Previous'}</Button>
                                    <Button variant="secondary" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>{isAr ? 'التالي' : 'Next'}</Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            <CreateCompanyModal
                open={createOpen}
                isAr={isAr}
                onClose={() => setCreateOpen(false)}
                onCreated={(res) => {
                    setCreateOpen(false);
                    setNotice(res.manager_invitation_error
                        ? { tone: 'warn', text: isAr ? `الحساب اتعمل، لكن دعوة المدير ماتبعتتش: ${errorText(res.manager_invitation_error, true)} — ابعتها من صفحة الحساب.` : `Company created, but the manager invitation was not sent: ${errorText(res.manager_invitation_error, false)} — send it from the company page.` }
                        : { tone: 'success', text: isAr ? 'الحساب اتعمل ودعوة المدير اتبعتت.' : 'Account created and the manager invited.' });
                    load();
                }}
            />
            <EditCompanyModal
                target={editing}
                isAr={isAr}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null);
                    setNotice({ tone: 'success', text: isAr ? 'التعديل اتحفظ.' : 'Changes saved.' });
                    load();
                }}
            />
            <DeleteCompanyModal
                target={deleting}
                isAr={isAr}
                onClose={() => setDeleting(null)}
                onDeleted={() => {
                    setDeleting(null);
                    setNotice({ tone: 'success', text: isAr ? 'الحساب اتحذف.' : 'Account deleted.' });
                    load();
                }}
            />
        </div>
    );
}

/**
 * The fields Ready Marine sets for an account. The row in the list does not carry all of
 * them (registration, tax card, grace days), so the account is fetched when this opens.
 */
function EditCompanyModal({ target, isAr, onClose, onSaved }) {
    const [form, setForm] = useState(null);
    // The account as saved: what a change of billing method is measured against.
    const [company, setCompany] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!target) return undefined;
        let cancelled = false;
        setForm(null);
        setError('');
        adminCompanyApi.get(target._id)
            .then(({ company }) => {
                if (cancelled) return;
                setCompany(company);
                setForm({
                    org_type: company.org_type || 'company',
                    name: company.name,
                    commercial_registration: company.commercial_registration,
                    tax_card: company.tax_card,
                    ...billingFormFrom(company),
                });
            })
            .catch((err) => { if (!cancelled) setError(errorText(err, isAr)); });
        return () => { cancelled = true; };
    }, [target, isAr]);

    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const t = orgTerms(form?.org_type || target?.org_type, isAr);

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await adminCompanyApi.update(target._id, {
                org_type: form.org_type,
                name: form.name,
                commercial_registration: form.commercial_registration,
                tax_card: form.tax_card,
                ...billingPatch(form),
            });
            onSaved();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    // Closed: the form of the last account is still in state, and has no account to describe.
    if (!target) return null;

    return (
        <Modal
            open={!!target}
            onClose={onClose}
            wide
            title={isAr ? `تعديل ${target?.name || ''}` : `Edit ${target?.name || ''}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy} disabled={!form}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            {!form ? (!error && <Spinner />) : (
                <div className="space-y-6">
                    <Section title={isAr ? 'نوع الحساب' : 'Account type'}>
                        <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {ORG_TYPES.map((type) => (
                                <button key={type} type="button" onClick={() => setForm({ ...form, org_type: type })}
                                    className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${form.org_type === type
                                        ? 'border-marine-cyan bg-marine-cyan/10 text-marine-primary'
                                        : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'}`}>
                                    {orgTypeLabel(type, isAr)}
                                </button>
                            ))}
                        </div>
                    </Section>

                    <Section title={isAr ? `بيانات ${t.the}` : t.One}>
                        <Field label={t.name} className="sm:col-span-2"><input className={`${INPUT} w-full`} value={form.name} onChange={set('name')} /></Field>
                        <Field label={isAr ? 'السجل التجاري (اختياري)' : 'Commercial registration (optional)'}><input className={`${INPUT} w-full`} value={form.commercial_registration} onChange={set('commercial_registration')} /></Field>
                        <Field label={isAr ? 'البطاقة الضريبية (اختياري)' : 'Tax card (optional)'}><input className={`${INPUT} w-full`} value={form.tax_card} onChange={set('tax_card')} /></Field>
                    </Section>

                    <Section title={isAr ? 'الحد والسداد' : 'Credit and payment'}>
                        <div className="sm:col-span-2">
                            <BillingModeFields company={company} form={form} setForm={setForm} isAr={isAr} t={t} />
                        </div>
                    </Section>

                    <p className="text-xs text-zinc-500">
                        {isAr ? 'المديرين والفروع وقاعدة التجميع بتتعدل من ' : 'Managers, branches and the consolidation rule are edited on '}
                        <Link href={`/admin/dashboard/companies/${target._id}`} className="font-bold text-marine-primary hover:underline">{isAr ? 'صفحة الحساب' : 'the account page'}</Link>.
                    </p>
                </div>
            )}
        </Modal>
    );
}

function DeleteCompanyModal({ target, isAr, onClose, onDeleted }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (target) setError(''); }, [target]);

    const remove = async () => {
        setBusy(true);
        setError('');
        try {
            await adminCompanyApi.remove(target._id);
            onDeleted();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={!!target}
            onClose={onClose}
            title={isAr ? 'حذف الحساب' : 'Delete account'}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button variant="danger" icon={Trash2} onClick={remove} loading={busy}>{isAr ? 'احذف نهائياً' : 'Delete for good'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
                {isAr ? <>هتحذف حساب <b>{target?.name}</b> نهائياً، ومعاه أعضاؤه ومديريه ودعواته. الحذف مابيترجعش.</> : <>You are deleting <b>{target?.name}</b> for good, with its members, managers and invitations. This cannot be undone.</>}
            </p>
            <p className="text-xs text-zinc-500 mt-3">
                {isAr ? 'الحذف للحسابات اللي ماعليهاش أوردرات ولا فواتير ولا مدفوعات. لو عليها، استخدم "إنهاء التعاقد" من صفحة الحساب.' : 'Only an account with no orders, invoices or payments can be deleted. Otherwise use "End contract" on the account page.'}
            </p>
        </Modal>
    );
}

function CreateCompanyModal({ open, isAr, onClose, onCreated }) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { if (open) { setForm(EMPTY_FORM); setError(''); } }, [open]);

    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const setOffice = (key) => (e) => setForm({ ...form, office: { ...form.office, [key]: e.target.value } });
    const setManager = (key) => (e) => setForm({ ...form, manager: { ...form.manager, [key]: e.target.value } });
    const t = orgTerms(form.org_type, isAr);

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await adminCompanyApi.create({
                ...form,
                monthly_cap: form.monthly_cap === '' ? '' : Number(form.monthly_cap),
                language: isAr ? 'ar' : 'en',
            });
            onCreated(res);
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            wide
            title={isAr ? 'حساب جديد' : 'New account'}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={submit} loading={busy}>{isAr ? 'اعمل الحساب وابعت دعوة المدير' : 'Create and invite the manager'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-6">
                <Section title={isAr ? 'نوع الحساب' : 'Account type'}>
                    <div className="sm:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {ORG_TYPES.map((type) => (
                            <button key={type} type="button" onClick={() => setForm({ ...form, org_type: type })}
                                className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition ${form.org_type === type
                                    ? 'border-marine-cyan bg-marine-cyan/10 text-marine-primary'
                                    : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'}`}>
                                {orgTypeLabel(type, isAr)}
                            </button>
                        ))}
                    </div>
                    <p className="sm:col-span-2 text-xs text-zinc-500">{isAr ? `هيظهر "${t.name}" و"${t.members}" و"${t.branches}" في كل الشاشات بتاعته.` : `Its screens will say "${t.name}", "${t.Members}" and "${t.Branches}".`}</p>
                </Section>

                <Section title={isAr ? `بيانات ${t.the}` : t.One}>
                    <Field label={t.name} className="sm:col-span-2"><input className={`${INPUT} w-full`} value={form.name} onChange={set('name')} /></Field>
                    <Field label={isAr ? 'السجل التجاري (اختياري)' : 'Commercial registration (optional)'}><input className={`${INPUT} w-full`} value={form.commercial_registration} onChange={set('commercial_registration')} /></Field>
                    <Field label={isAr ? 'البطاقة الضريبية (اختياري)' : 'Tax card (optional)'}><input className={`${INPUT} w-full`} value={form.tax_card} onChange={set('tax_card')} /></Field>
                </Section>

                <Section title={isAr ? 'الحد والسداد' : 'Credit and payment'}>
                    <Field label={isAr ? 'طريقة الحساب' : 'Billing method'} className="sm:col-span-2">
                        <select className={`${INPUT} w-full`} value={form.billing_mode} onChange={set('billing_mode')}>
                            <option value="monthly">{isAr ? 'فاتورة شهرية — تحويل بنكي' : 'Monthly invoice — bank transfer'}</option>
                            <option value="wallet">{isAr ? 'محفظة مسبقة الدفع' : 'Prepaid wallet'}</option>
                            <option value="credit_wallet">{isAr ? 'محفظة بحد ائتماني' : 'Wallet with a credit limit'}</option>
                        </select>
                    </Field>
                    {form.billing_mode === 'credit_wallet' ? <>
                    <p className="sm:col-span-2 text-sm text-zinc-500">{isAr ? `${t.the} ${t.v('تطلب', 'يطلب')} من غير شحن لحد الحد الائتماني، ورصيد المحفظة بينزل بالسالب. مدير ${t.the} يسدد بشحن المحفظة أونلاين. مفيش فواتير ولا ميعاد سداد — لما اللي عليها يوصل للحد، الطلب بيقف لحد ما تشحن.` : `The ${t.one} orders without topping up, down to the credit limit, and the wallet balance goes below zero. The manager pays it back by topping up online. No invoices and no due date — once what is owed reaches the limit, ordering stops until a top-up.`}</p>
                    <Field label={isAr ? 'الحد الائتماني (ج.م)' : 'Credit limit (EGP)'} className="sm:col-span-2" hint={isAr ? 'أقصى مبلغ رصيد المحفظة ينزله تحت الصفر. ده إجمالي اللي عليها، مش بيتجدد أول الشهر.' : 'How far below zero the wallet may go. It is the total owed, and does not renew each month.'}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.monthly_cap} onChange={set('monthly_cap')} />
                    </Field>
                    </> : form.billing_mode === 'wallet' ? <p className="sm:col-span-2 text-sm text-zinc-500">{isAr ? `المحفظة بتبدأ برصيد صفر. مدير ${t.the} يشحنها أونلاين ويوزع حدود ${t.members} في حدود الرصيد. كل أوردر لازم المحفظة تغطيه بالكامل.` : `The wallet starts at zero. The manager tops up online and assigns ${t.member} limits within the balance. Every order must be fully covered by the wallet.`}</p> : <>
                    <Field label={isAr ? 'السقف الشهري (ج.م)' : 'Monthly cap (EGP)'} hint={isAr ? `أقصى مبلغ ${t.v('تصرفه', 'يصرفه')} ${t.the} في الشهر.` : `The most the whole ${t.one} may spend a month.`}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.monthly_cap} onChange={set('monthly_cap')} />
                    </Field>
                    <Field label={isAr ? 'مدة السداد (أيام)' : 'Payment terms (days)'} hint={isAr ? 'الفاتورة الشهرية لازم تتدفع خلال كام يوم من إصدارها. فاضي = الافتراضي من الإعدادات.' : `Days the ${t.one} has to pay each monthly invoice. Blank = the default from company settings.`}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.payment_terms_days} onChange={set('payment_terms_days')} />
                    </Field>
                    <Field label={isAr ? 'مهلة التأخير قبل الإيقاف (أيام)' : 'Grace before suspension (days)'} hint={isAr ? `لو عدى ميعاد السداد، كام يوم زيادة قبل ما الطلب على حساب ${t.the} يتوقف لوحده. فاضي = الافتراضي من الإعدادات.` : 'Extra days after the due date before ordering on the account pauses by itself. Blank = the default from company settings.'}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.overdue_grace_days} onChange={set('overdue_grace_days')} />
                    </Field>
                    </>}
                </Section>

                <Section title={isAr ? `أول ${t.branch}` : `First ${t.branch}`}>
                    <Field label={isAr ? `اسم ${t.theBranch}` : `${t.Branch} name`}><input className={`${INPUT} w-full`} value={form.office.name} onChange={setOffice('name')} placeholder={isAr ? `${t.theBranch} الرئيسي` : `Main ${t.branch}`} /></Field>
                    <Field label={isAr ? `اسم اللي بيستلم الطرود في ${t.theBranch}` : `Who receives parcels at the ${t.branch}`} hint={isAr ? `بيتكتب على بوليصة الشحن جنب اسم ${t.theMember}، عشان المندوب يسلّم للاستقبال أو الأمن.` : `Printed on the waybill beside the ${t.member}'s name, so the courier hands it to reception or security.`}><input className={`${INPUT} w-full`} value={form.office.recipient_name} onChange={setOffice('recipient_name')} /></Field>
                    <Field label={isAr ? 'موبايل الاستلام' : 'Receiving mobile'}><input dir="ltr" className={`${INPUT} w-full`} value={form.office.phone} onChange={setOffice('phone')} placeholder="01xxxxxxxxx" /></Field>
                    <div className="sm:col-span-2">
                        <ShippingZoneSelect
                            variant="dashboard"
                            country={form.office.shipping_country}
                            city={form.office.shipping_city}
                            onChange={({ country, city }) => setForm((f) => ({ ...f, office: { ...f.office, shipping_country: country, shipping_city: city } }))}
                        />
                    </div>
                    <Field label={isAr ? 'العنوان بالتفصيل' : 'Full address'} className="sm:col-span-2">
                        <textarea rows={2} className={`${INPUT} w-full resize-none`} value={form.office.full_address} onChange={setOffice('full_address')} />
                    </Field>
                </Section>

                <Section title={isAr ? 'أول مدير للحساب' : 'First account manager'}>
                    <Field label={isAr ? 'الاسم' : 'Name'}><input className={`${INPUT} w-full`} value={form.manager.name} onChange={setManager('name')} /></Field>
                    <Field label={isAr ? 'الإيميل أو الموبايل' : 'Email or mobile'} hint={isAr ? `هيوصله دعوة يدخل بيها ${t.portal}.` : `They receive an invitation into the ${t.one} portal.`}>
                        <input dir="ltr" className={`${INPUT} w-full`} value={form.manager.identifier} onChange={setManager('identifier')} />
                    </Field>
                </Section>
            </div>
        </Modal>
    );
}

function Section({ title, children }) {
    return (
        <div>
            <p className="text-xs font-black uppercase tracking-widest text-marine-primary mb-3">{title}</p>
            <div className="grid sm:grid-cols-2 gap-3">{children}</div>
        </div>
    );
}

/** The month's share of the cap; amber past 80% and red once it is used up, like the managers' alerts. */
function CapShare({ spent, cap, isAr }) {
    const pct = Math.round((Number(spent || 0) / cap) * 100);
    const full = pct >= 100;
    const near = pct >= 80;
    return (
        <span className={`block text-[11px] ${full ? 'font-bold text-red-600 dark:text-red-400' : near ? 'font-bold text-amber-600 dark:text-amber-400' : 'text-zinc-500'}`}>
            {pct}%{full ? (isAr ? ' — السقف خلص' : ' — cap used up') : near ? (isAr ? ' — قرب يخلص' : ' — nearly used') : ''}
        </span>
    );
}
