'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '../../../../../components/LocaleLink';
import { ArrowLeft, ArrowRight, PauseCircle, PlayCircle, UserPlus, Send, XCircle, Users, History, FileX2, Banknote, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { adminCompanyApi, downloadFile } from '../../../../../lib/api';
import { resolveAssetUrl } from '../../../../../lib/assets';
import { ORG_TYPES, orgTerms, orgTypeLabel } from '../../../../../lib/orgTerms';
import { OrgTypeProvider, usePortalTerms } from '../../../../../components/company/OrgTermsContext';
import { formatMoney, formatDate, formatMonth, memberStatusLabel, memberStatusClass, limitSourceLabel, errorText, hasWallet, invoiceStatusLabel, invoiceStatusClass, formatLimit } from '../../../../../lib/companyLocalization';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, EmptyState, TableWrap, Th, Td, Pill, Modal, Field, StatCard, CompanyStatusPill,
} from '../../../../../components/company/CompanyUI';
import BillingModeFields, { billingFormFrom, billingPatch } from '../../../../../components/company/BillingModeFields';
import PurchasesView from '../../../../../components/company/PurchasesView';
import CompanyStatsView from '../../../../../components/company/CompanyStatsView';
import EmployeeHistoryModal from '../../../../../components/company/EmployeeHistoryModal';
import useRowLink from '../../../../../lib/useRowLink';

export default function AdminCompanyDetailPage() {
    const rowLink = useRowLink();
    const { id } = useParams();
    const { language } = useApp();
    const isAr = language === 'ar';
    const [data, setData] = useState(null);
    const [employees, setEmployees] = useState(null);
    const [historyOf, setHistoryOf] = useState(null);
    const [endingOpen, setEndingOpen] = useState(false);
    const [refundOpen, setRefundOpen] = useState(false);
    const [invitations, setInvitations] = useState([]);
    const [tab, setTab] = useState('overview');
    // Deep links (e.g. back from an invoice) open a given tab: ?tab=invoices
    useEffect(() => {
        const wanted = new URLSearchParams(window.location.search).get('tab');
        if (wanted) setTab(wanted);
    }, []);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [inviteOpen, setInviteOpen] = useState(false);
    const [editingManager, setEditingManager] = useState(null);
    const [purchases, setPurchases] = useState(null);
    const [purchasesMonth, setPurchasesMonth] = useState('');
    const [batches, setBatches] = useState(null);
    const [invoices, setInvoices] = useState(null);

    useEffect(() => {
        if (tab !== 'invoices') return;
        adminCompanyApi.getInvoices(id).then(setInvoices).catch((err) => setError(errorText(err, isAr)));
    }, [tab, id, isAr]);
    const [closingBatch, setClosingBatch] = useState('');

    const loadBatches = useCallback(() => adminCompanyApi.getBatches(id)
        .then(setBatches)
        .catch((err) => setError(errorText(err, isAr))), [id, isAr]);

    useEffect(() => {
        if (tab === 'batches') loadBatches();
    }, [tab, loadBatches]);

    const closeBatchNow = async (batch) => {
        const ok = confirm(isAr
            ? `تقفل دفعة ${batch.vendor_name} دلوقتي وتبعتها للمورد باللي فيها (${batch.waiting_count})؟`
            : `Close the ${batch.vendor_name} batch now and send it to the store with what it holds (${batch.waiting_count})?`);
        if (!ok) return;
        setClosingBatch(String(batch._id));
        try {
            await adminCompanyApi.closeBatch(id, batch._id);
            setMessage(isAr ? 'الدفعة اتقفلت واتبعتت للمورد' : 'Batch closed and sent to the store');
            await loadBatches();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setClosingBatch('');
        }
    };

    const load = useCallback(async () => {
        try {
            const [detail, invs] = await Promise.all([adminCompanyApi.get(id), adminCompanyApi.getManagerInvitations(id)]);
            setData(detail);
            setInvitations(invs.invitations || []);
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [id, isAr]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (tab !== 'purchases') return;
        adminCompanyApi.getPurchases(id, purchasesMonth ? { month: purchasesMonth } : {})
            .then((res) => { setPurchases(res); if (!purchasesMonth) setPurchasesMonth(res.month); })
            .catch((err) => setError(errorText(err, isAr)));
    }, [tab, purchasesMonth, id, isAr]);

    useEffect(() => {
        if (tab !== 'employees' || employees) return;
        adminCompanyApi.getEmployees(id).then(setEmployees).catch((err) => setError(errorText(err, isAr)));
    }, [tab, employees, id, isAr]);

    const act = async (fn, text) => {
        setError('');
        try {
            await fn();
            setMessage(text);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    const { company, counts, managers, consolidation, settlement } = data;
    const Back = isAr ? ArrowRight : ArrowLeft;
    const suspended = company.status === 'suspended';
    const ended = company.status === 'ended';
    const t = orgTerms(company.org_type, isAr);

    const suspend = () => {
        const note = prompt(isAr ? 'سبب الإيقاف (بيظهر للأدمن بس):' : 'Reason for suspending (admins only):', '');
        if (note === null) return;
        act(() => adminCompanyApi.suspend(id, note), isAr ? `${t.the} ${t.v('اتوقفت', 'اتوقف')}` : `${t.One} suspended`);
    };

    const removeManager = (m) => {
        const name = m.user?.name || m.user?.email || m.user?.phone || '';
        const last = managers.length === 1;
        const ok = confirm(isAr
            ? `تشيل ${name} من مديرين ${t.the}؟${m.is_employee ? ` هيفضل ${t.member} عادي.` : ''}${last ? ` ده آخر مدير — ${t.the} ${t.v('هتفضل', 'هيفضل')} من غير مدير لحد ما تبعت دعوة جديدة.` : ''}`
            : `Remove ${name} as a manager of this ${t.one}?${m.is_employee ? ` They stay a ${t.member}.` : ''}${last ? ' This is the last manager — nobody can run the account until you invite another.' : ''}`);
        if (!ok) return;
        act(() => adminCompanyApi.removeManager(id, m.membership_id), isAr ? 'المدير اتشال' : 'Manager removed');
    };

    const tabs = [
        { id: 'overview', label: isAr ? 'نظرة عامة' : 'Overview' },
        { id: 'employees', label: t.Members },
        { id: 'purchases', label: isAr ? 'المشتريات' : 'Purchases' },
        { id: 'batches', label: isAr ? 'الدفعات' : 'Batches' },
        // The side the account pays with now, and the other one while there is anything on it.
        ...(hasWallet(company.billing_mode) || company.has_wallet ? [{ id: 'wallet', label: isAr ? `محفظة ${t.the}` : `${t.One} wallet` }] : []),
        ...(!hasWallet(company.billing_mode) || company.has_invoices ? [{ id: 'invoices', label: isAr ? 'الفواتير والمدفوعات' : 'Invoices & payments' }] : []),
        { id: 'stats', label: isAr ? 'الإحصائيات' : 'Statistics' },
        { id: 'managers', label: isAr ? 'المديرين' : 'Managers' },
        { id: 'settings', label: isAr ? 'الإعدادات' : 'Settings' },
    ];

    return (
        <OrgTypeProvider value={company.org_type || 'company'}>
        <div>
            <Link href="/admin/dashboard/companies" className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-4">
                <Back size={16} /> {isAr ? 'كل الحسابات' : 'All accounts'}
            </Link>
            <PageHeader
                title={<span className="flex items-center gap-3">{company.name} <span className="text-xs font-bold text-zinc-500 rounded-lg bg-zinc-100 dark:bg-white/5 px-2 py-1">{orgTypeLabel(company.org_type, isAr)}</span> <CompanyStatusPill status={company.status} isAr={isAr} /></span>}
                subtitle={[
                    company.commercial_registration && `${isAr ? 'س.ت' : 'CR'} ${company.commercial_registration}`,
                    company.tax_card && `${isAr ? 'ب.ض' : 'Tax'} ${company.tax_card}`,
                    `${isAr ? 'اتعملت' : 'Created'} ${formatDate(company.created_at, isAr)}${company.created_by ? ` — ${company.created_by}` : ''}`,
                ].filter(Boolean).join(' · ')}
                actions={ended ? null : (
                    <>
                        {suspended
                            ? <Button variant="success" icon={PlayCircle} onClick={() => act(() => adminCompanyApi.reactivate(id), isAr ? `${t.the} ${t.v('اتفعلت', 'اتفعّل')}` : `${t.One} reactivated`)}>{isAr ? 'رجّع التفعيل' : 'Reactivate'}</Button>
                            : <Button variant="danger" icon={PauseCircle} onClick={suspend}>{isAr ? 'إيقاف' : 'Suspend'}</Button>}
                        <Button variant="secondary" icon={FileX2} onClick={() => setEndingOpen(true)}>{isAr ? 'إنهاء التعاقد' : 'End contract'}</Button>
                    </>
                )}
            />
            {ended && settlement && (
                <Notice tone="warn">
                    {isAr ? `العقد انتهى ${formatDate(settlement.ended_at, true)}` : `Contract ended ${formatDate(settlement.ended_at, false)}`}
                    {settlement.ended_by ? ` — ${settlement.ended_by}` : ''}
                    {settlement.note ? `: ${settlement.note}` : ''}
                </Notice>
            )}
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}
            {suspended && company.suspension && (
                <Notice tone="warn">
                    {isAr ? 'موقوفة' : 'Suspended'} {formatDate(company.suspension.at, isAr)}
                    {company.suspension.by ? ` — ${company.suspension.by}` : ''}
                    {company.suspension.reason === 'overdue' ? (isAr ? ' — بسبب تأخير السداد (بيرجع لوحده أول ما يتدفع)' : ' — for a late invoice (resumes by itself once paid)') : ''}
                    {company.suspension.note ? `: ${company.suspension.note}` : ''}
                </Notice>
            )}
            {!suspended && company.overdue_waiver_until && (
                <Notice tone="warn">
                    {isAr
                        ? `اتسمح لـ${t.the} ${t.v('تطلب', 'يطلب')} رغم التأخير لحد ${formatDate(company.overdue_waiver_until, true)} — بعدها ${t.v('بتتوقف', 'بيتوقف')} تاني لو ${t.v('فضلت متأخرة', 'فضل متأخر')}.`
                        : `The ${t.one} may order despite being late until ${formatDate(company.overdue_waiver_until, false)} — after that it pauses again if still late.`}
                </Notice>
            )}

            <div className="flex gap-1 border-b border-zinc-200 dark:border-white/10 mb-5 overflow-x-auto">
                {tabs.map((t) => (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                        className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-marine-cyan text-marine-primary' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'overview' && (
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard label={company.billing_mode === 'credit_wallet' ? (isAr ? 'المتاح للصرف' : 'Available to spend') : company.billing_mode === 'wallet' ? (isAr ? 'رصيد المحفظة / إجمالي الحد' : 'Wallet balance / total credit') : (isAr ? 'السقف الشهري' : 'Monthly cap')} value={formatMoney(company.monthly_cap, isAr)}
                        sub={company.billing_mode === 'credit_wallet' ? (isAr ? `الرصيد ${formatMoney(company.wallet_balance, true)} + حد ائتماني ${formatMoney(company.credit_line, true)}` : `Balance ${formatMoney(company.wallet_balance, false)} + a ${formatMoney(company.credit_line, false)} credit limit`) : undefined} />
                    <StatCard label={t.Members} value={String(counts.employees)} sub={isAr ? `${counts.pending_invitations} دعوة مستنية` : `${counts.pending_invitations} invitation(s) pending`} />
                    <StatCard label={isAr ? 'المديرين' : 'Managers'} value={String(counts.managers)} />
                    <StatCard
                        label={isAr ? 'قاعدة التجميع' : 'Consolidation rule'}
                        value={isAr ? `${consolidation.order_count} أوردر / ${consolidation.wait_hours} ساعة` : `${consolidation.order_count} orders / ${consolidation.wait_hours} h`}
                        sub={consolidation.overridden ? (isAr ? `خاصة بـ${t.the} ${t.v('دي', 'ده')}` : `Specific to this ${t.one}`) : (isAr ? 'الإعداد العام' : 'The global setting')}
                    />
                    {ended && settlement && (
                        <SettlementCard settlement={settlement} isAr={isAr} onRefund={() => setRefundOpen(true)} />
                    )}
                </div>
            )}

            {tab === 'employees' && (
                <div className={CARD}>
                    {!employees ? <Spinner /> : employees.rows.length === 0 ? (
                        <EmptyState icon={Users} title={isAr ? `لسه مفيش ${t.members.replace(/^ال/, '')}` : `No ${t.members} yet`} />
                    ) : (
                        <TableWrap>
                            <table className="w-full min-w-[760px]">
                                <thead className="border-b border-zinc-100 dark:border-white/5">
                                    <tr>
                                        <Th align="start">{isAr ? t.theMember : t.Member}</Th>
                                        <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                                        <Th align="start">{isAr ? 'الجروب' : 'Group'}</Th>
                                        <Th align="start">{isAr ? 'الفرع' : 'Branch'}</Th>
                                        <Th align="start">{isAr ? 'الليميت' : 'Limit'}</Th>
                                        <Th align="start">{isAr ? 'صرف الشهر' : 'Spent'}</Th>
                                        <Th align="end">{isAr ? 'السجل' : 'History'}</Th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {employees.rows.map((r) => (
                                        <tr key={`${r.kind}-${r._id}`}>
                                            <Td align="start">
                                                <p className="font-bold text-zinc-900 dark:text-white">{r.name || '—'}</p>
                                                <p className="text-xs text-zinc-500" dir="ltr">{r.email || r.phone}</p>
                                            </Td>
                                            <Td align="start"><Pill className={memberStatusClass(r.status)}>{memberStatusLabel(r.status, isAr)}</Pill></Td>
                                            <Td align="start">{r.group_name || '—'}</Td>
                                            <Td align="start">{r.office_name || '—'}</Td>
                                            <Td align="start">
                                                {r.kind === 'member' ? (
                                                    <>
                                                        <span dir="ltr" className="tabular-nums font-bold">{formatLimit(r.limit, isAr)}</span>
                                                        <p className="text-[11px] text-zinc-500">{limitSourceLabel(r.limit_source, isAr)}</p>
                                                    </>
                                                ) : '—'}
                                            </Td>
                                            <Td align="start">{r.kind === 'member' ? <span dir="ltr" className="tabular-nums">{formatMoney(r.spent, isAr)}</span> : '—'}</Td>
                                            <Td align="end">
                                                {r.kind === 'member' && (
                                                    <button type="button" onClick={() => setHistoryOf(r)} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'السجل' : 'History'}>
                                                        <History size={16} />
                                                    </button>
                                                )}
                                            </Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableWrap>
                    )}
                    <EmployeeHistoryModal
                        row={historyOf}
                        isAr={isAr}
                        onClose={() => setHistoryOf(null)}
                        load={(membershipId) => adminCompanyApi.getEmployeeHistory(id, membershipId)}
                    />
                </div>
            )}

            <EndContractModal
                open={endingOpen}
                company={company}
                isAr={isAr}
                onClose={() => setEndingOpen(false)}
                onEnded={async (res) => {
                    setEndingOpen(false);
                    const n = res.invoices?.length || 0;
                    setMessage(isAr
                        ? `العقد انتهى. ${n ? `اتعملت ${n} فاتورة ختامية` : 'مفيش أوردرات تتفوتر'}، واتفك ${res.employees_released} ${t.member}.`
                        : `Contract ended. ${n ? `${n} final invoice(s) issued` : 'Nothing left to invoice'}; ${res.employees_released} ${t.member}(s) released.`);
                    await load();
                }}
            />
            <RefundModal
                open={refundOpen}
                companyId={id}
                due={settlement?.refund_due || 0}
                isAr={isAr}
                onClose={() => setRefundOpen(false)}
                onSaved={async () => { setRefundOpen(false); setMessage(isAr ? 'التحويل اتسجل' : 'Refund recorded'); await load(); }}
            />

            {tab === 'purchases' && (!purchases ? <Spinner /> : (
                <PurchasesView
                    data={purchases}
                    isAr={isAr}
                    month={purchasesMonth || purchases.month}
                    onMonthChange={setPurchasesMonth}
                    onExport={() => downloadFile(adminCompanyApi.exportPurchasesUrl(id, { month: purchases.month }))}
                />
            ))}

            {tab === 'managers' && (
                <div className={`${CARD} p-5`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <p className="text-sm text-zinc-500">{isAr ? `المديرين بيضيفوا بعض من ${t.portal}. هنا بتضيف مدير لو محدش قبل أو كلهم مشيوا.` : 'Managers add each other from the portal. Add one here if nobody accepted or everyone left.'}</p>
                        <Button icon={UserPlus} onClick={() => setInviteOpen(true)}>{isAr ? 'دعوة مدير' : 'Invite a manager'}</Button>
                    </div>
                    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                        {managers.map((m) => (
                            <li key={m.membership_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="font-bold text-zinc-900 dark:text-white">{m.user?.name}{m.is_employee && <span className="ms-2 text-[10px] font-black uppercase text-emerald-600">{isAr ? `${t.member} كمان` : `Also a ${t.member}`}</span>}</p>
                                    <p className="text-xs text-zinc-500" dir="ltr">{[m.user?.email, m.user?.phone].filter(Boolean).join(' · ')} · {formatDate(m.joined_at, isAr)}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="ghost" icon={Pencil} onClick={() => setEditingManager(m)} title={isAr ? 'تعديل' : 'Edit'} aria-label={isAr ? 'تعديل' : 'Edit'} />
                                    <Button variant="danger" icon={Trash2} onClick={() => removeManager(m)} title={isAr ? 'حذف' : 'Delete'} aria-label={isAr ? 'حذف' : 'Delete'} />
                                </div>
                            </li>
                        ))}
                        {invitations.map((inv) => (
                            <li key={inv._id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                        {inv.name || (isAr ? 'مدير مدعو' : 'Invited manager')}
                                        <Pill className={memberStatusClass(inv.status)}>{memberStatusLabel(inv.status, isAr)}</Pill>
                                    </p>
                                    <p className="text-xs text-zinc-500" dir="ltr">{inv.email || inv.phone} · {formatDate(inv.expires_at, isAr)}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" icon={Send} onClick={() => act(() => adminCompanyApi.resendInvitation(id, inv._id), isAr ? 'الدعوة اتبعتت تاني' : 'Invitation resent')}>{isAr ? 'ابعت تاني' : 'Resend'}</Button>
                                    <Button variant="ghost" icon={XCircle} onClick={() => act(() => adminCompanyApi.revokeInvitation(id, inv._id), isAr ? 'الدعوة اتلغت' : 'Invitation cancelled')}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                                </div>
                            </li>
                        ))}
                        {managers.length === 0 && invitations.length === 0 && (
                            <li className="py-3 text-sm text-red-600">{isAr ? `${t.the} ${t.v('مالهاش', 'مالوش')} مدير. ابعت دعوة.` : `This ${t.one} has no manager. Send an invitation.`}</li>
                        )}
                    </ul>
                </div>
            )}

            {tab === 'batches' && (!batches ? <Spinner /> : (
                <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <StatCard label={isAr ? 'التوفير في الشحن (الشهر)' : 'Shipping saved (month)'} value={formatMoney(batches.month?.savings || 0, isAr)} tone="profit" />
                        <StatCard label={isAr ? 'طرود مجمّعة' : 'Combined parcels'} value={String(batches.month?.combined_parcels || 0)} />
                        <StatCard label={isAr ? 'طرود اتوفرت' : 'Parcels saved'} value={String(batches.month?.parcels_saved || 0)} />
                    </div>
                    {batches.batches.length === 0 ? (
                        <EmptyState title={isAr ? 'لسه مفيش دفعات' : 'No batches yet'} message={isAr ? `الدفعات بتبدأ لما ${t.member} يطلب بالتجميع على ${t.theBranch}.` : 'Batches start when an employee orders with consolidation to the branch.'} />
                    ) : (
                        <TableWrap>
                            <thead>
                                <tr>
                                    <Th align="start">{isAr ? 'المورد' : 'Store'}</Th>
                                    <Th align="start">{isAr ? 'الفرع' : 'Branch'}</Th>
                                    <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                                    <Th align="start">{isAr ? 'الأوردرات' : 'Orders'}</Th>
                                    <Th align="start">{isAr ? 'اتفتحت / آخر ميعاد' : 'Opened / deadline'}</Th>
                                    <Th align="start">{isAr ? 'الشحن' : 'Shipping'}</Th>
                                    <Th align="start" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {batches.batches.map((b) => (
                                    <tr key={b._id}>
                                        <Td align="start" className="font-bold">{b.vendor_name}</Td>
                                        <Td align="start">{b.office_name}</Td>
                                        <Td align="start">
                                            <Pill className={b.status === 'open' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' : b.status === 'closed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300'}>
                                                {({ open: isAr ? 'مستنية' : 'Waiting', closing: isAr ? 'بتتقفل' : 'Closing', closed: isAr ? 'اتقفلت' : 'Closed', cancelled: isAr ? 'اتلغت' : 'Cancelled' })[b.status]}
                                            </Pill>
                                            {b.close_reason && <span className="block text-[11px] text-zinc-500 mt-1">{b.close_reason === 'count' ? (isAr ? 'العدد كمل' : 'filled') : b.close_reason === 'admin' ? (isAr ? 'اتقفلت من الأدمن' : 'closed by admin') : (isAr ? 'الوقت خلص' : 'time up')}</span>}
                                        </Td>
                                        <Td align="start">
                                            <span className="tabular-nums">{b.status === 'open' ? `${b.waiting_count} / ${b.target_count}` : b.live_count}</span>
                                            <span className="block text-[11px] text-zinc-500 max-w-[220px] truncate">{(b.members || []).filter((m) => m.status !== 'left' && !m.dropped_at).map((m) => m.display_name).join('، ')}</span>
                                        </Td>
                                        <Td align="start" className="text-xs">
                                            {formatDate(b.opened_at, isAr)}
                                            <span className="block text-zinc-500">{new Date(b.deadline_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}</span>
                                        </Td>
                                        <Td align="start" className="text-xs tabular-nums">
                                            {b.parcel_shipping != null ? formatMoney(b.parcel_shipping, isAr) : '—'}
                                            {Number(b.company_absorbed) > 0 && <span className="block text-amber-600">{isAr ? `${t.the} ${t.v('اتحملت', 'اتحمل')} ` : `${t.one} absorbed `}{formatMoney(b.company_absorbed, isAr)}</span>}
                                        </Td>
                                        <Td align="start">
                                            {b.status === 'open' && (
                                                <Button variant="secondary" loading={closingBatch === String(b._id)} onClick={() => closeBatchNow(b)}>
                                                    {isAr ? 'اقفلها دلوقتي' : 'Close now'}
                                                </Button>
                                            )}
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </TableWrap>
                    )}
                </div>
            ))}

            {tab === 'invoices' && (!invoices ? <Spinner /> : (
                <div className="space-y-5">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label={isAr ? 'اتفوتر' : 'Invoiced'} value={formatMoney(invoices.totals.invoiced, isAr)} />
                        <StatCard label={isAr ? 'اتدفع' : 'Paid'} value={formatMoney(invoices.totals.paid, isAr)} tone="profit" />
                        <StatCard label={isAr ? 'متبقي' : 'Outstanding'} value={formatMoney(invoices.totals.outstanding, isAr)} tone={invoices.totals.outstanding > 0 ? 'warn' : 'neutral'} />
                        <StatCard label={isAr ? 'متأخر' : 'Overdue'} value={formatMoney(invoices.totals.overdue, isAr)} tone={invoices.totals.overdue > 0 ? 'loss' : 'neutral'} />
                    </div>
                    {invoices.pending_months.length > 0 && (
                        <div className={`${CARD} p-4 text-sm text-zinc-600 dark:text-zinc-300 space-y-1`}>
                            {invoices.pending_months.map((m) => (
                                <p key={m.month}>
                                    <span className="font-bold">{formatMonth(m.month, isAr)}</span>
                                    {' — '}<span dir="ltr" className="tabular-nums">{formatMoney(m.completed_total ?? m.running_total, isAr)}</span>
                                    {' · '}{invoiceStatusLabel(m.state, isAr)}
                                    {m.waiting_total > 0 && (
                                        <span className="text-zinc-500">
                                            {isAr
                                                ? ` · + ${formatMoney(m.waiting_total, true)} على ${m.waiting_orders} أوردر لسه ماوصلش (بيتفوتر لما يوصل)`
                                                : ` · + ${formatMoney(m.waiting_total, false)} on ${m.waiting_orders} order(s) not delivered yet (invoiced on arrival)`}
                                        </span>
                                    )}
                                </p>
                            ))}
                        </div>
                    )}
                    {invoices.invoices.length === 0 ? (
                        <EmptyState title={isAr ? 'لسه مفيش فواتير' : 'No invoices yet'} message={isAr ? 'الفاتورة بتصدر لوحدها أول يوم في كل شهر عن الشهر اللي قبله.' : 'Invoices issue by themselves on the 1st of each month for the month before.'} />
                    ) : (
                        <TableWrap>
                            <thead>
                                <tr>
                                    <Th align="start">{isAr ? 'الفاتورة' : 'Invoice'}</Th>
                                    <Th align="start">{isAr ? 'الشهر' : 'Month'}</Th>
                                    <Th align="start">{isAr ? 'المطلوب' : 'Due'}</Th>
                                    <Th align="start">{isAr ? 'المتبقي' : 'Left'}</Th>
                                    <Th align="start">{isAr ? 'آخر ميعاد' : 'Due date'}</Th>
                                    <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                                    <Th align="start" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {invoices.invoices.map((inv) => (
                                    <tr key={inv._id} {...rowLink(`/admin/dashboard/companies/${id}/invoices/${inv._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                        <Td align="start" className="font-mono font-bold"><span dir="ltr">{inv.number}</span></Td>
                                        <Td align="start">{formatMonth(inv.month, isAr)}{inv.contract_stage && <span className="block text-[11px] font-bold text-marine-primary">{inv.contract_stage === 'final' ? (isAr ? 'ختامية' : 'Final') : (isAr ? 'تسوية بعد النهاية' : 'After the end')}</span>}</Td>
                                        <Td align="start" className="tabular-nums"><span dir="ltr">{formatMoney(inv.amount_due, isAr)}</span></Td>
                                        <Td align="start" className="tabular-nums font-bold"><span dir="ltr">{formatMoney(inv.balance, isAr)}</span></Td>
                                        <Td align="start">
                                            {formatDate(inv.due_at, isAr)}
                                            {inv.days_overdue > 0 && <span className="block text-[11px] text-red-600 dark:text-red-400">{isAr ? `متأخرة ${inv.days_overdue} يوم` : `${inv.days_overdue} day(s) late`}</span>}
                                        </Td>
                                        <Td align="start">
                                            <Pill className={invoiceStatusClass(inv.display_status)}>{invoiceStatusLabel(inv.display_status, isAr)}</Pill>
                                            {inv.pending_receipts > 0 && <span className="block text-[11px] font-bold text-amber-600 mt-1">{isAr ? `${inv.pending_receipts} إيصال مستني تأكيد` : `${inv.pending_receipts} receipt(s) to confirm`}</span>}
                                        </Td>
                                        <Td align="start">
                                            <Link href={`/admin/dashboard/companies/${id}/invoices/${inv._id}`} className="text-sm font-bold text-marine-primary hover:underline">
                                                {isAr ? 'افتح' : 'Open'}
                                            </Link>
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </TableWrap>
                    )}
                </div>
            ))}

            {tab === 'stats' && (
                <CompanyStatsView
                    isAr={isAr}
                    scope="company"
                    load={(params) => adminCompanyApi.getCompanyStats(id, params)}
                    exportUrl={(params) => adminCompanyApi.exportCompanyStatsUrl(id, params)}
                />
            )}

            {tab === 'wallet' && <AdminWallet id={id} isAr={isAr} />}
            {tab === 'settings' && <SettingsForm company={company} isAr={isAr} onSaved={(text) => { setMessage(text); load(); }} onError={(text) => setError(text)} id={id} />}

            <InviteManagerModal
                open={inviteOpen}
                isAr={isAr}
                onClose={() => setInviteOpen(false)}
                onSubmit={async (form) => {
                    const res = await adminCompanyApi.inviteManager(id, { ...form, language: isAr ? 'ar' : 'en' });
                    setInviteOpen(false);
                    setMessage(res.direct ? (isAr ? 'بقى مدير على طول' : 'Made a manager straight away') : (isAr ? 'الدعوة اتبعتت' : 'Invitation sent'));
                    await load();
                }}
            />
            <EditManagerModal
                manager={editingManager}
                isAr={isAr}
                onClose={() => setEditingManager(null)}
                onSubmit={async (changes) => {
                    await adminCompanyApi.updateManager(id, editingManager.membership_id, changes);
                    setEditingManager(null);
                    setMessage(isAr ? 'بيانات المدير اتحدثت' : 'Manager details updated');
                    await load();
                }}
            />
        </div>
        </OrgTypeProvider>
    );
}

function SettingsForm({ company, isAr, onSaved, onError, id }) {
    const [form, setForm] = useState(() => ({
        org_type: company.org_type || 'company',
        name: company.name,
        commercial_registration: company.commercial_registration,
        tax_card: company.tax_card,
        ...billingFormFrom(company),
        show_logo_on_homepage: company.show_logo_on_homepage !== false,
        override_enabled: company.consolidation_override.enabled,
        order_count: company.consolidation_override.order_count ?? '',
        wait_hours: company.consolidation_override.wait_hours ?? '',
    }));
    const [busy, setBusy] = useState(false);
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

    const save = async () => {
        setBusy(true);
        try {
            await adminCompanyApi.update(id, {
                org_type: form.org_type,
                name: form.name,
                commercial_registration: form.commercial_registration,
                tax_card: form.tax_card,
                ...billingPatch(form),
                show_logo_on_homepage: form.show_logo_on_homepage,
                consolidation_override: {
                    enabled: form.override_enabled,
                    order_count: form.order_count === '' ? null : Number(form.order_count),
                    wait_hours: form.wait_hours === '' ? null : Number(form.wait_hours),
                },
            });
            onSaved(isAr ? 'اتحفظ' : 'Saved');
        } catch (err) {
            onError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    const t = orgTerms(form.org_type, isAr);
    return (
        <div className={`${CARD} p-5 space-y-6`}>
            <Field label={isAr ? 'نوع الحساب' : 'Account type'} hint={isAr ? `الشاشات بتقول "${t.members}" و"${t.branches}".` : `Screens say "${t.Members}" and "${t.Branches}".`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ORG_TYPES.map((type) => (
                        <button key={type} type="button" onClick={() => setForm({ ...form, org_type: type })}
                            className={`rounded-xl border px-3 py-2 text-sm font-bold transition ${form.org_type === type
                                ? 'border-marine-cyan bg-marine-cyan/10 text-marine-primary'
                                : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'}`}>
                            {orgTypeLabel(type, isAr)}
                        </button>
                    ))}
                </div>
            </Field>
            <div className="grid sm:grid-cols-3 gap-3">
                <Field label={t.name}><input className={`${INPUT} w-full`} value={form.name} onChange={set('name')} /></Field>
                <Field label={isAr ? 'السجل التجاري (اختياري)' : 'Commercial registration (optional)'}><input className={`${INPUT} w-full`} value={form.commercial_registration} onChange={set('commercial_registration')} /></Field>
                <Field label={isAr ? 'البطاقة الضريبية (اختياري)' : 'Tax card (optional)'}><input className={`${INPUT} w-full`} value={form.tax_card} onChange={set('tax_card')} /></Field>
            </div>
            <BillingModeFields company={company} form={form} setForm={setForm} isAr={isAr} t={t} />
            {/* The logo the account's manager uploaded, and whether it is on the home page.
                The manager decides; this is where Ready Marine can take one down. */}
            <div className="rounded-xl border border-zinc-100 dark:border-white/5 p-4 flex flex-wrap items-center gap-4">
                <div className="w-32 h-16 rounded-lg border border-dashed border-zinc-200 dark:border-white/10 bg-white flex items-center justify-center px-2">
                    {company.logo
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={resolveAssetUrl(company.logo)} alt="" className="max-h-12 max-w-full object-contain" />
                        : <span className="text-[11px] text-zinc-400">{isAr ? 'مفيش لوجو' : 'No logo'}</span>}
                </div>
                <label className="flex items-start gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-100">
                    <input type="checkbox" className="accent-marine-cyan w-4 h-4 mt-0.5" checked={form.show_logo_on_homepage} onChange={(e) => setForm({ ...form, show_logo_on_homepage: e.target.checked })} />
                    <span>
                        {isAr ? 'يظهر في الصفحة الرئيسية ضمن "عملاء ريدي مارين من المؤسسات"' : 'Shown on the home page under "Ready Marine\'s corporate clients"'}
                        <span className="block text-xs font-medium text-zinc-400">{isAr ? `مدير ${t.the} هو اللي بيرفع اللوجو من إعدادات ${t.portal}.` : `The ${t.one}'s manager uploads the logo from their portal settings.`}</span>
                    </span>
                </label>
            </div>
            <div className="rounded-xl border border-zinc-100 dark:border-white/5 p-4">
                <label className="flex items-center gap-2 text-sm font-bold text-zinc-800 dark:text-zinc-100">
                    <input type="checkbox" className="accent-marine-cyan w-4 h-4" checked={form.override_enabled} onChange={(e) => setForm({ ...form, override_enabled: e.target.checked })} />
                    {isAr ? `قاعدة تجميع خاصة بـ${t.the} ${t.v('دي', 'ده')}` : `A consolidation rule just for this ${t.one}`}
                </label>
                <p className="text-xs text-zinc-500 mt-1">{isAr ? 'مثلاً حساب كبير ياخد 10 أوردرات في 24 ساعة. فاضي = الإعداد العام.' : 'e.g. a large account on 10 orders in 24 hours. Blank = the global setting.'}</p>
                {form.override_enabled && (
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                        <Field label={isAr ? 'عدد الأوردرات' : 'Order count'}><input type="number" min="2" dir="ltr" className={`${INPUT} w-full`} value={form.order_count} onChange={set('order_count')} /></Field>
                        <Field label={isAr ? 'ساعات الانتظار' : 'Waiting hours'}><input type="number" min="1" dir="ltr" className={`${INPUT} w-full`} value={form.wait_hours} onChange={set('wait_hours')} /></Field>
                    </div>
                )}
            </div>
            <div className="flex justify-end"><Button onClick={save} loading={busy}>{isAr ? 'حفظ' : 'Save'}</Button></div>
        </div>
    );
}

function InviteManagerModal({ open, isAr, onClose, onSubmit }) {
    const [form, setForm] = useState({ name: '', identifier: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setForm({ name: '', identifier: '' }); setError(''); } }, [open]);

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            await onSubmit(form);
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title={isAr ? 'دعوة مدير' : 'Invite a manager'}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={submit} loading={busy} disabled={!form.identifier.trim()}>{isAr ? 'ابعت' : 'Send'}</Button>
                </>
            )}>
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? 'الاسم' : 'Name'}><input className={`${INPUT} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                <Field label={isAr ? 'الإيميل أو الموبايل' : 'Email or mobile'}><input dir="ltr" className={`${INPUT} w-full`} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></Field>
            </div>
        </Modal>
    );
}

function EditManagerModal({ manager, isAr, onClose, onSubmit }) {
    const [form, setForm] = useState({ email: '', phone: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (manager) { setForm({ email: manager.user?.email || '', phone: manager.user?.phone || '' }); setError(''); }
    }, [manager]);

    // Only what was actually changed is sent, so an untouched field is never re-validated.
    const changes = {};
    if (form.email.trim() !== (manager?.user?.email || '')) changes.email = form.email.trim();
    if (form.phone.trim() !== (manager?.user?.phone || '')) changes.phone = form.phone.trim();
    const dirty = Object.keys(changes).length > 0;

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            await onSubmit(changes);
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={!!manager} onClose={onClose} title={isAr ? `تعديل بيانات ${manager?.user?.name || 'المدير'}` : `Edit ${manager?.user?.name || 'manager'}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={submit} loading={busy} disabled={!dirty || !form.phone.trim()}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}>
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? 'الإيميل' : 'Email'}><input type="email" dir="ltr" className={`${INPUT} w-full`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                <Field label={isAr ? 'الموبايل' : 'Mobile'} hint={isAr ? 'دي بيانات دخول المدير على Ready Marine — هيسجل دخول بيها بعد التعديل.' : 'These are the manager’s Ready Marine sign-in details — they sign in with the new ones afterwards.'}><input type="tel" dir="ltr" className={`${INPUT} w-full`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </div>
        </Modal>
    );
}

/** An ended contract: what the company still owes, and what Ready Marine owes back. */
function SettlementCard({ settlement, isAr, onRefund }) {
    const ot = usePortalTerms(isAr);
    const m = (v) => formatMoney(v, isAr);
    return (
        <div className={`${CARD} p-5 sm:col-span-2 xl:col-span-4 space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-black text-zinc-900 dark:text-white">{isAr ? 'تسوية نهاية التعاقد' : 'End-of-contract settlement'}</h3>
                {settlement.refund_due > 0 && (
                    <Button icon={Banknote} onClick={onRefund}>{isAr ? `سجّل تحويل ${ot.toThe}` : 'Record a refund'}</Button>
                )}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div>
                    <p className="text-zinc-500">{isAr ? `على ${ot.the}` : `${ot.The} owes`}</p>
                    <p className="font-black tabular-nums text-lg" dir="ltr">{m(settlement.outstanding)}</p>
                </div>
                <div>
                    <p className="text-zinc-500">{isAr ? `${ot.toThe} عندنا (لسه ماتحولش)` : `Owed back to ${ot.the}`}</p>
                    <p className={`font-black tabular-nums text-lg ${settlement.refund_due > 0 ? 'text-amber-600' : ''}`} dir="ltr">{m(settlement.refund_due)}</p>
                </div>
                <div>
                    <p className="text-zinc-500">{isAr ? `اتحوّل ${ot.toThe}` : 'Refunded so far'}</p>
                    <p className="font-black tabular-nums text-lg" dir="ltr">{m(settlement.refunded)}</p>
                </div>
            </div>
            {Math.abs(settlement.pending_adjustments || 0) > 0.004 && (
                <p className="text-xs text-zinc-500">
                    {isAr
                        ? `فيه ${m(Math.abs(settlement.pending_adjustments))} ${settlement.pending_adjustments < 0 ? 'مرتجعات/توفير' : 'تحصيلات'} وصلت بعد الفاتورة الختامية — هتطلع في كشف تسوية أول الشهر الجاي، وتتخصم من المتبقي أو ترجع للشركة.`
                        : `${m(Math.abs(settlement.pending_adjustments))} of ${settlement.pending_adjustments < 0 ? 'returns/savings' : 'charges'} arrived after the final invoice — they go on a settlement statement on the next 1st, set against what is owed or refunded.`}
                </p>
            )}
            {settlement.refunds.length > 0 && (
                <ul className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
                    {settlement.refunds.map((r) => (
                        <li key={r._id}>
                            <span className="tabular-nums font-bold" dir="ltr">{m(r.amount)}</span>
                            {` — ${formatDate(r.paid_on, isAr)}`}{r.reference ? ` — ${r.reference}` : ''}{r.recorded_by ? ` (${r.recorded_by})` : ''}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function EndContractModal({ open, company, isAr, onClose, onEnded }) {
    const t = orgTerms(company?.org_type, isAr);
    const [note, setNote] = useState('');
    const [confirmName, setConfirmName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setNote(''); setConfirmName(''); setError(''); } }, [open]);
    if (!open) return null;
    const matches = confirmName.trim().toLowerCase() === String(company.name).trim().toLowerCase();

    const submit = async () => {
        setBusy(true);
        setError('');
        try {
            onEnded(await adminCompanyApi.endContract(company._id, note));
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
            title={isAr ? `إنهاء التعاقد مع ${company.name}` : `End the contract with ${company.name}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button variant="danger" icon={FileX2} loading={busy} disabled={!matches} onClick={submit}>{isAr ? 'إنهاء التعاقد نهائياً' : 'End the contract for good'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-200">
                <ul className="list-disc ps-5 space-y-1.5">
                    <li>{isAr ? `مفيش طلب جديد على حساب ${t.the} من اللحظة دي، والدعوات المستنية بتتلغي.` : `No new orders on the ${t.one} account from now on; pending invitations are cancelled.`}</li>
                    <li>{isAr ? `${t.members} بيرجعوا عملاء عاديين، وبيوصلهم إشعار. الأوردرات اللي اتطلبت (حتى المستنية في دفعات) بتكمل عادي.` : `${t.Members} go back to being ordinary customers and are told. Orders already placed — waiting in batches too — carry on.`}</li>
                    <li>{isAr ? 'الفاتورة الختامية بتطلع دلوقتي بكل اللي لسه ماتفوترش.' : 'The final invoice is issued now for everything not invoiced yet.'}</li>
                    <li>{isAr ? `أي مرتجع أو توفير بعد كده بيتخصم من المتبقي على ${t.the}، والباقي بيبقى ${t.v('ليها', 'ليه')} وتحوّله إنت وتسجله هنا.` : `Any return or saving afterwards is set against what the ${t.one} owes; the rest is owed back — transfer it and record it here.`}</li>
                    <li>{isAr ? `المديرين بيفضل عندهم ${t.portal} عشان الفواتير والسداد. الإنهاء مابيترجعش.` : 'Managers keep the portal for invoices and payments. This cannot be undone.'}</li>
                </ul>
                <Field label={isAr ? 'ملحوظة (للأدمن)' : 'Note (for admins)'}>
                    <textarea className={`${INPUT} w-full`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Field label={isAr ? `اكتب ${t.name} "${company.name}" للتأكيد` : `Type the ${t.one} name "${company.name}" to confirm`}>
                    <input className={`${INPUT} w-full`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                </Field>
            </div>
        </Modal>
    );
}

function RefundModal({ open, companyId, due, isAr, onClose, onSaved }) {
    const ot = usePortalTerms(isAr);
    const today = new Date().toISOString().slice(0, 10);
    const [form, setForm] = useState({ amount: '', paid_on: today, reference: '', note: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setForm({ amount: String(due || ''), paid_on: today, reference: '', note: '' }); setError(''); } }, [open, due, today]);
    if (!open) return null;
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await adminCompanyApi.recordRefund(companyId, { ...form, amount: Number(form.amount) });
            onSaved();
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
            title={isAr ? `تحويل ${ot.toThe}` : `Refund to ${ot.the}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy} disabled={!(Number(form.amount) > 0)}>{isAr ? 'سجّل' : 'Record'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <p className="text-sm text-zinc-500 mb-4">{isAr ? `المستحق ${ot.toThe}: ${formatMoney(due, true)}` : `Owed to ${ot.the}: ${formatMoney(due, false)}`}</p>
            <div className="grid sm:grid-cols-2 gap-4">
                <Field label={isAr ? 'المبلغ' : 'Amount'}><input type="number" min="0" step="0.01" dir="ltr" className={`${INPUT} w-full`} value={form.amount} onChange={set('amount')} /></Field>
                <Field label={isAr ? 'تاريخ التحويل' : 'Transfer date'}><input type="date" dir="ltr" className={`${INPUT} w-full`} value={form.paid_on} onChange={set('paid_on')} /></Field>
                <Field label={isAr ? 'رقم المرجع' : 'Reference'}><input className={`${INPUT} w-full`} value={form.reference} onChange={set('reference')} /></Field>
                <Field label={isAr ? 'ملحوظة' : 'Note'}><input className={`${INPUT} w-full`} value={form.note} onChange={set('note')} /></Field>
            </div>
        </Modal>
    );
}

function AdminWallet({ id, isAr }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    useEffect(() => {
        adminCompanyApi.getWallet(id, page).then(setData).catch((err) => setError(errorText(err, isAr)));
    }, [id, page, isAr]);
    if (error) return <Notice>{error}</Notice>;
    if (!data) return <Spinner />;
    return <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-4">
            <StatCard label={data.credit_line > 0 ? (isAr ? 'رصيد المحفظة' : 'Wallet balance') : (isAr ? 'الرصيد / إجمالي الحد' : 'Balance / total credit')} value={formatMoney(data.balance, isAr)}
                sub={data.credit_line > 0 ? (isAr ? `حد ائتماني ${formatMoney(data.credit_line, true)} — متاح للصرف ${formatMoney(data.credit_limit, true)}` : `${formatMoney(data.credit_line, false)} credit limit — ${formatMoney(data.credit_limit, false)} available to spend`) : undefined} />
            {hasWallet(data.company.billing_mode) && <>
            <StatCard label={isAr ? 'المخصص المتبقي' : 'Remaining allocations'} value={formatMoney(data.allocated, isAr)} />
            <StatCard label={isAr ? 'متاح للتوزيع' : 'Available to allocate'} value={formatMoney(data.available_to_allocate, isAr)} />
            </>}
        </div>
        {!hasWallet(data.company.billing_mode) && <Notice tone="info">{isAr
            ? 'الحساب على فاتورة شهرية دلوقتي. اللي في المحفظة — رصيد أو مبلغ مستحق — بيتسوّى في الفاتورة الجاية.'
            : 'The account is on a monthly invoice now. What is in the wallet — a balance or an amount owed — is settled on its next invoice.'}</Notice>}
        <div className={CARD}><TableWrap><table className="w-full"><thead><tr>
            <Th align="start">{isAr ? 'التاريخ' : 'Date'}</Th><Th align="start">{isAr ? 'الحركة' : 'Transaction'}</Th>
            <Th align="start">{isAr ? 'المبلغ' : 'Amount'}</Th><Th align="start">{isAr ? 'الرصيد بعدها' : 'Balance after'}</Th>
        </tr></thead><tbody>{data.transactions.map((t) => <tr key={t._id}>
            <Td align="start">{formatDate(t.created_at, isAr)}</Td><Td align="start">{{ topup: isAr ? 'شحن' : 'Top-up', purchase: isAr ? 'أوردر' : 'Order', refund: isAr ? 'استرداد' : 'Refund', reversal: isAr ? 'إرجاع خصم' : 'Reversal', settlement: isAr ? 'تسوية' : 'Settlement', invoice: isAr ? 'اتنقل للفاتورة' : 'Moved to the invoice' }[t.kind] || t.kind}</Td>
            <Td align="start">{formatMoney(t.amount, isAr)}</Td><Td align="start">{formatMoney(t.balance_after, isAr)}</Td>
        </tr>)}</tbody></table></TableWrap>
        {!data.transactions.length && <p className="p-6 text-zinc-500">{isAr ? 'مفيش حركات لسه.' : 'No transactions yet.'}</p>}
        <div className="p-4 flex justify-between items-center">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{isAr ? 'السابق' : 'Previous'}</Button>
            <span>{page} / {data.pagination.pages}</span>
            <Button variant="secondary" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>{isAr ? 'التالي' : 'Next'}</Button>
        </div></div>
    </div>;
}
