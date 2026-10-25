'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '../../components/LocaleLink';
import {
    Wallet, PiggyBank, Users, CheckCircle2, Circle, ArrowLeft, ArrowRight, Building2, Layers, Truck, UserPlus, Receipt,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { companyPortalApi } from '../../lib/api';
import { formatMoney, formatMonth, formatDate, errorText, invoiceStatusLabel, hasWallet } from '../../lib/companyLocalization';
import { CARD, StatCard, Spinner, Notice, PageHeader, Button } from '../../components/company/CompanyUI';
import BatchProgress from '../../components/company/BatchProgress';
import { usePortalTerms } from '../../components/company/OrgTermsContext';

export default function CompanyHomePage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [confirming, setConfirming] = useState('');

    const load = useCallback(async () => {
        try {
            setData(await companyPortalApi.getOverview());
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const confirmStep = async (step) => {
        setConfirming(step);
        try {
            await companyPortalApi.confirmSetupStep(step);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setConfirming('');
        }
    };

    if (!data) {
        return error ? <Notice>{error}</Notice> : <Spinner />;
    }

    const { company, month, counts, setup, setup_complete: setupComplete } = data;
    // Either kind of wallet: prepaid, or with a credit line under it.
    const prepaid = hasWallet(company.billing_mode);
    const onCredit = company.billing_mode === 'credit_wallet';
    const Arrow = isAr ? ArrowLeft : ArrowRight;
    const capUsed = month.cap > 0 ? Math.min(100, Math.round((month.spent / month.cap) * 100)) : 0;

    const steps = [
        {
            key: 'office',
            done: setup.office_confirmed,
            icon: Building2,
            title: isAr ? `أكد عنوان ${ot.theBranch}` : `Confirm your ${ot.branch} address`,
            body: isAr ? 'الطرود المجمّعة هتتوصل هنا.' : 'Consolidated parcels are delivered here.',
            href: '/company/offices',
            confirm: true,
        },
        {
            key: 'default_limit',
            done: setup.default_limit_set,
            icon: Layers,
            title: isAr ? 'حدد الليميت الافتراضي' : 'Set the default limit',
            body: isAr ? `اللي هيصرفه كل ${ot.member} في الشهر لو مش في جروب.` : `What each ${ot.member} may spend a month when not in a group.`,
            href: '/company/settings',
        },
        {
            key: 'modes',
            done: setup.modes_confirmed,
            icon: Truck,
            title: isAr ? 'شغّل مودات التوصيل' : 'Turn on the delivery modes',
            body: isAr ? `تجميع على ${ot.theBranch}، فوري، أو الاتنين.` : `Consolidate to ${ot.branch}, instant, or both.`,
            href: '/company/settings',
        },
        {
            key: 'employees',
            done: setup.employees_added,
            icon: UserPlus,
            title: isAr ? `ضيف ${ot.members}` : `Add your ${ot.members}`,
            body: isAr ? 'ارفع ملف Excel أو ضيفهم واحد واحد.' : 'Upload an Excel file or add them one by one.',
            href: '/company/employees',
        },
    ];

    // The oldest invoice with money owed — late, or due within a week.
    const due = data.invoice_due;
    const dueSoon = due && due.balance > 0 && (due.display_status === 'overdue' || new Date(due.due_at) - Date.now() < 7 * 24 * 3600 * 1000);

    const attention = [
        dueSoon && {
            key: 'invoice',
            text: due.display_status === 'overdue'
                ? (isAr ? `فاتورة ${formatMonth(due.month, true)} متأخرة — فاضل ${formatMoney(due.balance, true)}` : `The ${formatMonth(due.month, false)} invoice is overdue — ${formatMoney(due.balance, false)} left`)
                : (isAr ? `فاتورة ${formatMonth(due.month, true)} ميعادها ${formatDate(due.due_at, true)} — ${formatMoney(due.balance, true)}` : `The ${formatMonth(due.month, false)} invoice is due ${formatDate(due.due_at, false)} — ${formatMoney(due.balance, false)}`),
            href: `/company/invoices/${due._id}`,
        },
        counts.pending_invitations > 0 && {
            key: 'pending',
            text: isAr ? `${counts.pending_invitations} دعوة لسه ماحدش ردّ عليها` : `${counts.pending_invitations} invitation(s) not answered yet`,
            href: '/company/employees?status=pending',
        },
        counts.expired_invitations > 0 && {
            key: 'expired',
            text: isAr ? `${counts.expired_invitations} دعوة انتهت من غير ما حد يقبلها` : `${counts.expired_invitations} invitation(s) expired unanswered`,
            href: '/company/employees?status=expired',
        },
        counts.declined_invitations > 0 && {
            key: 'declined',
            text: isAr ? `${counts.declined_invitations} رفضوا الدعوة` : `${counts.declined_invitations} declined the invitation`,
            href: '/company/employees?status=declined',
        },
        counts.employees_without_group > 0 && company.groups.length > 0 && {
            key: 'nogroup',
            text: isAr ? `${counts.employees_without_group} ${ot.member} من غير جروب (بياخدوا الليميت الافتراضي)` : `${counts.employees_without_group} ${ot.member}(s) in no group (on the default limit)`,
            href: '/company/employees?group=none',
        },
    ].filter(Boolean);

    return (
        <div>
            <PageHeader
                title={isAr ? `أهلاً في لوحة ${company.name}` : `Welcome to ${company.name}`}
                subtitle={isAr
                    ? `${formatMonth(month.key, true)} — الليميتات بتتجدد ${formatDate(month.renews_on, true)}`
                    : `${formatMonth(month.key, false)} — limits renew on ${formatDate(month.renews_on, false)}`}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                {onCredit ? <StatCard label={isAr ? 'رصيد المحفظة' : 'Wallet balance'} value={formatMoney(company.wallet_balance, isAr)} sub={isAr ? `متاح للصرف ${formatMoney(company.total_credit_limit, true)} (بالحد الائتماني ${formatMoney(company.credit_line, true)}). اشحن المحفظة عشان تسدد اللي عليكم.` : `${formatMoney(company.total_credit_limit, false)} available to spend (with the ${formatMoney(company.credit_line, false)} credit limit). Top up the wallet to pay back what you owe.`} icon={Wallet} /> : prepaid ? <StatCard label={isAr ? 'رصيد المحفظة / إجمالي الحد' : 'Wallet balance / total credit'} value={formatMoney(company.wallet_balance, isAr)} sub={isAr ? 'كل أوردر بيتخصم من الرصيد. الرصيد مش بيتجدد أول الشهر.' : 'Every order is deducted from this balance. It does not reset each month.'} icon={Wallet} /> : <div className={`${CARD} p-5`}>
                    <div className="flex items-start justify-between gap-3">
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{isAr ? 'صرف الشهر من السقف' : 'Spent this month vs cap'}</p>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50 dark:bg-marine-cyan/10 text-marine-primary"><Wallet size={16} /></div>
                    </div>
                    <p className="text-2xl font-black mt-2 tabular-nums" dir="ltr">{formatMoney(month.spent, isAr)}</p>
                    <div className="mt-3 h-2 rounded-full bg-zinc-100 dark:bg-white/5 overflow-hidden">
                        <div className="h-full bg-marine-cyan rounded-full" style={{ width: `${capUsed}%` }} />
                    </div>
                    <p className="text-xs text-zinc-500 mt-1.5">{isAr ? `من سقف ${formatMoney(month.cap, true)}` : `of a ${formatMoney(month.cap, false)} cap`}</p>
                </div>}
                <StatCard
                    label={isAr ? 'التوفير في الشحن' : 'Shipping savings'}
                    value={formatMoney(month.shipping_savings, isAr)}
                    sub={month.parcels_saved
                        ? (isAr ? `${month.parcels_saved} طرد اتوفروا بالتجميع على ${ot.theBranch}` : `${month.parcels_saved} parcel(s) saved by consolidating to the ${ot.branch}`)
                        : (isAr ? `من التوصيل المجمّع على ${ot.theBranch}` : `from consolidated ${ot.branch} delivery`)}
                    icon={PiggyBank}
                    tone="profit"
                />
                <StatCard
                    label={isAr ? `${ot.members} النشطين` : `Active ${ot.members}`}
                    value={`${counts.active_employees} / ${counts.employees}`}
                    sub={isAr ? 'طلبوا الشهر ده من المسجلين' : 'ordered this month, of those registered'}
                    icon={Users}
                />
                <Link href={prepaid ? '/company/wallet' : due ? `/company/invoices/${due._id}` : '/company/invoices'} className="block">
                    <StatCard
                        label={prepaid ? (isAr ? `محفظة ${ot.the}` : `${ot.One} wallet`) : (isAr ? 'الفاتورة المستحقة' : 'Invoice due')}
                        value={prepaid ? (isAr ? 'اشحن المحفظة' : 'Top up wallet') : due ? formatMoney(due.balance, isAr) : formatMoney(0, isAr)}
                        sub={prepaid ? (isAr ? 'شحن أونلاين وسجل حركة الرصيد' : 'Online payments and transaction history') : due
                            ? `${formatMonth(due.month, isAr)} · ${due.display_status === 'overdue' ? invoiceStatusLabel('overdue', isAr) : `${isAr ? 'قبل' : 'by'} ${formatDate(due.due_at, isAr)}`}`
                            : (isAr ? 'مفيش فواتير مستحقة' : 'Nothing due')}
                        icon={Receipt}
                        tone={due?.display_status === 'overdue' ? 'loss' : due ? 'warn' : 'neutral'}
                    />
                </Link>
            </div>

            {(data.batches?.open || []).length > 0 && (
                <div className={`${CARD} p-5 mb-6`}>
                    <h2 className="font-black text-zinc-900 dark:text-white mb-1 flex items-center gap-2"><Truck size={18} className="text-marine-primary" />{isAr ? 'دفعات مستنية' : 'Batches waiting'}</h2>
                    <p className="text-xs text-zinc-500 mb-4">{isAr ? `أوردرات ${ot.membersN} مستنية زمايلهم من نفس المورد عشان تتشحن طرد واحد على ${ot.theBranch}.` : `${ot.Member} orders waiting for colleagues ordering from the same store, to ship as one parcel to the ${ot.branch}.`}</p>
                    <ul className="grid md:grid-cols-2 gap-3">
                        {data.batches.open.map((b) => (
                            <li key={b._id} className="rounded-xl border border-zinc-100 dark:border-white/5 p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-bold text-zinc-900 dark:text-white">{b.vendor_name}</p>
                                    <p className="text-xs text-zinc-500">{b.office_name}</p>
                                </div>
                                <BatchProgress waiting={b.waiting_count} target={b.target_count} deadline={b.deadline_at} isAr={isAr} dark={false} />
                                <p className="text-[11px] text-zinc-500">{b.members.filter((m) => m.status === 'waiting').map((m) => m.display_name).join('، ')}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {company.status === 'ended' ? null : !setupComplete ? (
                <div className={`${CARD} p-5`}>
                    <h2 className="font-black text-zinc-900 dark:text-white mb-1">{isAr ? `جهّز حساب ${ot.the}` : `Set up the ${ot.one} account`}</h2>
                    <p className="text-sm text-zinc-500 mb-4">{isAr ? `4 خطوات ${ot.v('وتبدأ', 'ويبدأ')} ${ot.the} ${ot.v('تطلب', 'يطلب')}.` : `Four steps and your ${ot.one} is ready to order.`}</p>
                    <ol className="space-y-3">
                        {steps.map((step) => (
                            <li key={step.key} className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-zinc-100 dark:border-white/5 p-4">
                                <div className="flex items-start gap-3 flex-1">
                                    {step.done
                                        ? <CheckCircle2 size={22} className="text-emerald-500 shrink-0 mt-0.5" />
                                        : <Circle size={22} className="text-zinc-300 dark:text-zinc-600 shrink-0 mt-0.5" />}
                                    <div>
                                        <p className={`font-bold text-sm ${step.done ? 'text-zinc-400 line-through' : 'text-zinc-900 dark:text-white'}`}>{step.title}</p>
                                        <p className="text-xs text-zinc-500 mt-0.5">{step.body}</p>
                                    </div>
                                </div>
                                {!step.done && (
                                    <div className="flex gap-2 sm:ms-auto">
                                        {step.confirm && (
                                            <Button variant="secondary" loading={confirming === step.key} onClick={() => confirmStep(step.key)}>
                                                {isAr ? 'العنوان مظبوط' : "It's correct"}
                                            </Button>
                                        )}
                                        <Link href={step.href} className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark">
                                            {isAr ? 'روح' : 'Go'} <Arrow size={14} />
                                        </Link>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ol>
                </div>
            ) : (
                <div className={`${CARD} p-5`}>
                    <h2 className="font-black text-zinc-900 dark:text-white mb-3">{isAr ? 'محتاج منك' : 'Needs your attention'}</h2>
                    {attention.length === 0 ? (
                        <p className="text-sm text-zinc-500 flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-emerald-500" />
                            {isAr ? 'مفيش حاجة محتاجة تتعمل دلوقتي.' : 'Nothing needs doing right now.'}
                        </p>
                    ) : (
                        <ul className="divide-y divide-zinc-100 dark:divide-white/5">
                            {attention.map((item) => (
                                <li key={item.key}>
                                    <Link href={item.href} className="flex items-center justify-between gap-3 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200 hover:text-marine-primary">
                                        <span>{item.text}</span>
                                        <Arrow size={16} className="shrink-0" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
