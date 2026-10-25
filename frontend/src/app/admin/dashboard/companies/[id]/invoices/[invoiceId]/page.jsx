'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '../../../../../../../components/LocaleLink';
import { Printer, Plus, ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../../../../../../context/AppContext';
import { adminCompanyApi } from '../../../../../../../lib/api';
import { errorText } from '../../../../../../../lib/companyLocalization';
import { CARD, Button, Notice, Spinner } from '../../../../../../../components/company/CompanyUI';
import InvoiceDocument, { InvoicePrintStyle } from '../../../../../../../components/company/InvoiceDocument';
import { PaymentList, PaymentForm, openReceipt } from '../../../../../../../components/company/InvoicePayments';
import { OrgTypeProvider } from '../../../../../../../components/company/OrgTermsContext';

/**
 * One company invoice, for the admin: the statement, the transfers against it, and the
 * three things only the admin does — record a transfer that reached the bank, confirm a
 * receipt the company uploaded (correcting the amount if the bank shows another), or
 * reject it with a reason the company reads.
 */
export default function AdminCompanyInvoicePage() {
    const { id, invoiceId } = useParams();
    const { language } = useApp();
    const isAr = language === 'ar';
    const [invoice, setInvoice] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [formOpen, setFormOpen] = useState(false);
    const [busyId, setBusyId] = useState('');
    const Back = isAr ? ArrowRight : ArrowLeft;

    const load = useCallback(async () => {
        try {
            setInvoice((await adminCompanyApi.getInvoice(id, invoiceId)).invoice);
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [id, invoiceId, isAr]);

    useEffect(() => { load(); }, [load]);

    const act = async (key, fn, text) => {
        setBusyId(key);
        setError('');
        try {
            await fn();
            setMessage(text);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusyId('');
        }
    };

    const confirm = (p) => {
        const typed = window.prompt(
            isAr ? 'المبلغ اللي وصل البنك فعلاً (سيبه زي ما هو لو مطابق):' : 'The amount that actually reached the bank (leave as is if it matches):',
            String(p.amount)
        );
        if (typed === null) return;
        const amount = Number(typed);
        act(`c-${p._id}`, () => adminCompanyApi.confirmPayment(id, p._id, amount && amount !== p.amount ? { amount } : {}),
            isAr ? 'التحويل اتأكد' : 'Transfer confirmed');
    };

    const reject = (p) => {
        const reason = window.prompt(isAr ? 'سبب الرفض (مدير الحساب هيشوفه):' : 'Why is it rejected? (the account manager reads this)', '');
        if (!reason) return;
        act(`r-${p._id}`, () => adminCompanyApi.rejectPayment(id, p._id, reason), isAr ? 'الإيصال اترفض' : 'Receipt rejected');
    };

    if (!invoice) return error ? <Notice>{error}</Notice> : <Spinner />;

    return (
        <div className="max-w-4xl">
            <InvoicePrintStyle />
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <Link href={`/admin/dashboard/companies/${id}?tab=invoices`} className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                    <Back size={16} /> {isAr ? 'فواتير الحساب' : "The account's invoices"}
                </Link>
                <div className="flex gap-2">
                    {invoice.balance > 0 && <Button icon={Plus} onClick={() => setFormOpen(true)}>{isAr ? 'سجّل تحويل' : 'Record a transfer'}</Button>}
                    <Button variant="secondary" icon={Printer} onClick={() => window.print()}>{isAr ? 'اطبع / احفظ PDF' : 'Print / save PDF'}</Button>
                </div>
            </div>
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <OrgTypeProvider value={invoice.company_snapshot?.org_type || 'company'}><InvoiceDocument invoice={invoice} isAr={isAr} /></OrgTypeProvider>

            <div className={`${CARD} p-5 mt-6`}>
                <h2 className="font-black text-zinc-900 dark:text-white mb-3">{isAr ? 'التحويلات' : 'Transfers'}</h2>
                <PaymentList
                    payments={invoice.payments}
                    isAr={isAr}
                    busyId={busyId}
                    onOpenReceipt={(p) => openReceipt(() => adminCompanyApi.getReceipt(id, p._id)).catch((err) => setError(errorText(err, isAr)))}
                    onConfirm={confirm}
                    onReject={reject}
                />
            </div>

            {formOpen && (
                <PaymentForm
                    open
                    onClose={() => setFormOpen(false)}
                    balance={invoice.balance}
                    isAr={isAr}
                    title={isAr ? `تحويل وصل البنك — ${invoice.number}` : `Transfer received — ${invoice.number}`}
                    submitLabel={isAr ? 'سجّل' : 'Record'}
                    onSubmit={async (form, file) => {
                        await adminCompanyApi.recordPayment(id, invoice._id, form, file);
                        setMessage(isAr ? 'التحويل اتسجّل' : 'Transfer recorded');
                        await load();
                    }}
                />
            )}
        </div>
    );
}
