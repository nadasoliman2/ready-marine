'use client';

import { useEffect, useState } from 'react';
import Link from '../../../../../components/LocaleLink';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { adminCompanyApi } from '../../../../../lib/api';
import { errorText } from '../../../../../lib/companyLocalization';
import { CARD, INPUT, PageHeader, Button, Notice, Spinner, Field } from '../../../../../components/company/CompanyUI';

/**
 * The global consolidation rule — how long an office's orders from one vendor
 * wait, and how many close a batch early — plus the defaults stamped on each
 * new company. A company's own override (on its page) beats the rule here.
 */
export default function AdminCompanySettingsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        adminCompanyApi.getSettings()
            .then((res) => setForm(res.settings))
            .catch((err) => setError(errorText(err, isAr)));
    }, [isAr]);

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await adminCompanyApi.updateSettings({
                batch_order_count: Number(form.batch_order_count),
                batch_wait_hours: Number(form.batch_wait_hours),
                default_payment_terms_days: Number(form.default_payment_terms_days),
                default_overdue_grace_days: Number(form.default_overdue_grace_days),
                invoice_reminder_days: Number(form.invoice_reminder_days),
                bank_details: form.bank_details,
            });
            setForm(res.settings);
            setMessage(isAr ? 'اتحفظ' : 'Saved');
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    if (!form) return error ? <Notice>{error}</Notice> : <Spinner />;
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const setBank = (key) => (e) => setForm({ ...form, bank_details: { ...(form.bank_details || {}), [key]: e.target.value } });
    const bank = form.bank_details || {};
    const Back = isAr ? ArrowRight : ArrowLeft;

    return (
        <div className="max-w-3xl">
            <Link href="/admin/dashboard/companies" className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-4">
                <Back size={16} /> {isAr ? 'كل الحسابات' : 'All accounts'}
            </Link>
            <PageHeader title={isAr ? 'إعدادات حسابات الشركات والجهات' : 'Corporate account settings'} />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <section className={`${CARD} p-5 mb-4`}>
                <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'تجميع الأوردرات على الفرع' : 'Consolidating orders to the branch'}</h2>
                <p className="text-sm text-zinc-500 mt-1 mb-4">
                    {isAr
                        ? 'أوردرات أعضاء نفس الفرع أو المبنى من نفس المورد بتستنى في دفعة. الدفعة بتتحرك طرد واحد أول ما العدد يكمل أو الوقت يخلص — أيهم الأول. لو الوقت خلص بتتحرك باللي فيها حتى لو أوردر واحد.'
                        : "Orders from one branch to one vendor wait in a batch. It ships as one parcel as soon as the count is reached or the time runs out, whichever comes first — with whatever it holds, even a single order."}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={isAr ? 'عدد الأوردرات اللي بيقفل الدفعة' : 'Orders that close a batch'} hint={isAr ? '2 على الأقل' : 'At least 2'}>
                        <input type="number" min="2" dir="ltr" className={`${INPUT} w-full`} value={form.batch_order_count} onChange={set('batch_order_count')} />
                    </Field>
                    <Field label={isAr ? 'أقصى انتظار (ساعات)' : 'Longest wait (hours)'} hint={isAr ? 'من أول أوردر دخل الدفعة، ساعات عادية' : 'From the first order in the batch, calendar hours'}>
                        <input type="number" min="1" dir="ltr" className={`${INPUT} w-full`} value={form.batch_wait_hours} onChange={set('batch_wait_hours')} />
                    </Field>
                </div>
                <p className="text-xs text-zinc-400 mt-3">
                    {isAr ? 'تقدر تعمل قاعدة مختلفة لحساب معين من صفحته.' : 'Give a single account a different rule from its own page.'}
                </p>
            </section>

            <section className={`${CARD} p-5 mb-4`}>
                <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'افتراضي الحسابات الجديدة' : 'Defaults for new accounts'}</h2>
                <p className="text-sm text-zinc-500 mt-1 mb-4">{isAr ? 'بيتسجلوا على الحساب وقت ما يتعمل، وبعد كده كل حساب ليه قيمته.' : 'Stamped on a company when it is created; each keeps its own copy after.'}</p>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={isAr ? 'مدة السداد (أيام)' : 'Payment terms (days)'}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.default_payment_terms_days} onChange={set('default_payment_terms_days')} />
                    </Field>
                    <Field label={isAr ? 'مهلة التأخير قبل الإيقاف (أيام)' : 'Grace before suspension (days)'}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.default_overdue_grace_days} onChange={set('default_overdue_grace_days')} />
                    </Field>
                </div>
            </section>

            <section className={`${CARD} p-5 mb-4`}>
                <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? 'الفواتير والتحصيل' : 'Invoices and collection'}</h2>
                <p className="text-sm text-zinc-500 mt-1 mb-4">
                    {isAr
                        ? 'بيانات الحساب البنكي دي بتتطبع على كل فاتورة عشان يحوّلوا عليها. التذكير الأول بيروح للمديرين قبل الميعاد بعدد الأيام ده، وتذكير تاني يوم الميعاد.'
                        : 'These account details are printed on every company invoice for the transfer. The first reminder goes to the managers this many days before the due date, and another on the day.'}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                    <Field label={isAr ? 'اسم البنك' : 'Bank'}>
                        <input className={`${INPUT} w-full`} value={bank.bank_name || ''} onChange={setBank('bank_name')} />
                    </Field>
                    <Field label={isAr ? 'اسم الحساب' : 'Account name'}>
                        <input className={`${INPUT} w-full`} value={bank.account_name || ''} onChange={setBank('account_name')} />
                    </Field>
                    <Field label={isAr ? 'رقم الحساب' : 'Account number'}>
                        <input dir="ltr" className={`${INPUT} w-full`} value={bank.account_number || ''} onChange={setBank('account_number')} />
                    </Field>
                    <Field label="IBAN">
                        <input dir="ltr" className={`${INPUT} w-full`} value={bank.iban || ''} onChange={setBank('iban')} />
                    </Field>
                    <Field className="sm:col-span-2" label={isAr ? 'تعليمات إضافية (اختياري)' : 'Extra instructions (optional)'}>
                        <input className={`${INPUT} w-full`} value={bank.instructions || ''} onChange={setBank('instructions')} />
                    </Field>
                    <Field label={isAr ? 'التذكير الأول قبل الميعاد (أيام)' : 'First reminder before due (days)'}>
                        <input type="number" min="0" dir="ltr" className={`${INPUT} w-full`} value={form.invoice_reminder_days} onChange={set('invoice_reminder_days')} />
                    </Field>
                </div>
            </section>

            <div className="flex justify-end"><Button onClick={save} loading={busy}>{isAr ? 'حفظ' : 'Save'}</Button></div>
        </div>
    );
}
